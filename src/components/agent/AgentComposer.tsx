import { useState, useRef, useEffect } from "react";
import { Paperclip, X, Image as ImageIcon } from "lucide-react";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { SlashCommandMenu, type SlashCommand } from "./SlashCommandMenu";
import { VoiceInputButton } from "./VoiceInputButton";
import { cn } from "@/lib/utils";

export interface AttachedImage {
  url: string;        // data URL
  mediaType: string;  // e.g. image/png
  filename: string;
}

interface Props {
  status: "submitted" | "streaming" | "ready" | "error";
  onSend: (text: string, images: AttachedImage[]) => void;
  onStop?: () => void;
}

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });

/** Detects "/word" at the very start of the input — opens slash menu. */
function detectSlashQuery(text: string): string | null {
  const m = /^\/([\w-]*)$/.exec(text);
  return m ? m[1] : null;
}

export const AgentComposer = ({ status, onSend, onStop }: Props) => {
  const [text, setText] = useState("");
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const slashQuery = detectSlashQuery(text);

  useEffect(() => {
    if (status === "ready") ref.current?.focus();
  }, [status]);

  // Listen for external prefill events (e.g. visual element picker).
  useEffect(() => {
    const onAppend = (e: Event) => {
      const detail = (e as CustomEvent<{ text?: string; submit?: boolean }>).detail;
      if (!detail?.text) return;
      // Auto-submit shortcut (e.g. approval card "Approve & start" button)
      if (detail.submit && status === "ready") {
        onSend(detail.text, []);
        setText("");
        setImages([]);
        return;
      }
      setText((prev) => (prev ? prev.replace(/\s*$/, "\n\n") + detail.text : detail.text));
      setTimeout(() => {
        const ta = ref.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        ta.scrollTop = ta.scrollHeight;
      }, 0);
    };
    window.addEventListener("agent-composer-append", onAppend);
    return () => window.removeEventListener("agent-composer-append", onAppend);
  }, [status, onSend]);

  const handleSubmit = (e: { preventDefault?: () => void }) => {
    e.preventDefault?.();
    const trimmed = text.trim();
    // Allow sending in "ready" AND "error" states — error means the previous
    // stream died (e.g. tool-input validation), and the user must be able to
    // unstick the chat with a new prompt instead of being permanently locked.
    if ((!trimmed && images.length === 0) || (status !== "ready" && status !== "error")) return;
    onSend(trimmed, images);
    setText("");
    setImages([]);
  };

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    const arr = Array.from(files as any as File[]).slice(0, 4);
    const next: AttachedImage[] = [];
    for (const f of arr) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > 8 * 1024 * 1024) continue; // 8 MB cap
      const url = await fileToDataUrl(f);
      next.push({ url, mediaType: f.type, filename: f.name || `pasted-${Date.now()}.png` });
    }
    setImages((prev) => [...prev, ...next].slice(0, 6));
  };

  // Drag-and-drop screenshots onto the composer
  const onDragOver = (e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.items).some((it) => it.kind === "file")) {
      e.preventDefault();
      setDragOver(true);
    }
  };
  const onDragLeave = () => setDragOver(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    void handleFiles(e.dataTransfer.files);
  };

  // Paste screenshot from clipboard
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f && f.type.startsWith("image/")) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      void handleFiles(files);
    }
  };

  const pickSlash = (cmd: SlashCommand) => {
    setText(cmd.template);
    setTimeout(() => {
      const ta = ref.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }, 0);
  };

  return (
    <div
      className="space-y-2 relative"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {slashQuery !== null && (
        <SlashCommandMenu
          query={slashQuery}
          onPick={pickSlash}
          onClose={() => setText("")}
        />
      )}

      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <ImageIcon className="h-4 w-4" /> Drop screenshot to attach
          </div>
        </div>
      )}

      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((img, i) => (
            <div key={i} className="relative">
              <img
                src={img.url}
                alt={img.filename}
                className="h-16 w-16 rounded-md object-cover border border-border"
              />
              <button
                type="button"
                onClick={() => setImages((p) => p.filter((_, j) => j !== i))}
                className="absolute -top-1 -right-1 rounded-full bg-background border border-border p-0.5 active:scale-95"
                aria-label="Remove image"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <PromptInput onSubmit={handleSubmit as any}>
        <PromptInputTextarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          placeholder="Describe what to build, paste a screenshot, or type / for commands…"
          className={cn(dragOver && "ring-2 ring-primary/40")}
        />
        <PromptInputFooter className="justify-between">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground active:scale-95 transition-transform px-2 py-1"
              aria-label="Attach image"
            >
              <Paperclip className="h-4 w-4" />
              <span className="hidden sm:inline">Attach</span>
            </button>
            <VoiceInputButton
              disabled={status !== "ready" && status !== "error"}
              onTranscript={(t) => setText((prev) => (prev ? prev.replace(/\s*$/, " ") + t : t))}
            />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <PromptInputSubmit
            status={status}
            disabled={!text.trim() && images.length === 0}
            onStop={onStop}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
};
