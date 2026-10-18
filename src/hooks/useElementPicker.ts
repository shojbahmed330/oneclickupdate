// Drives the visual element picker in the preview iframe. The runtime
// (`public/lovable-picker.js`, injected during sandbox bootstrap) toggles a
// crosshair overlay when it receives `lovable:picker:enable`, and posts a
// `lovable:picker:selected` message back when the user clicks an element.
//
// On selection we dispatch a global `agent-composer-append` CustomEvent so
// the chat composer can prefill itself without prop-drilling state through
// every layer of the Builder shell.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type SelectedPayload = {
  selector: string;
  tag: string;
  text?: string;
  role?: string;
  ariaLabel?: string;
  url?: string;
};

export function useElementPicker(iframeRef: React.RefObject<HTMLIFrameElement>) {
  const [active, setActive] = useState(false);
  const [editActive, setEditActive] = useState(false);
  const activeRef = useRef(false);
  activeRef.current = active;

  const send = useCallback(
    (msg: { type: string }) => {
      const w = iframeRef.current?.contentWindow;
      if (!w) return;
      try {
        w.postMessage(msg, "*");
      } catch {
        /* cross-origin — postMessage still works without targetOrigin check */
      }
    },
    [iframeRef],
  );

  const enable = useCallback(() => {
    setActive(true);
    setEditActive(false);
    send({ type: "lovable:edit:disable" });
    send({ type: "lovable:picker:enable" });
  }, [send]);

  const disable = useCallback(() => {
    setActive(false);
    send({ type: "lovable:picker:disable" });
  }, [send]);

  const toggle = useCallback(() => {
    activeRef.current ? disable() : enable();
  }, [enable, disable]);

  const toggleEdit = useCallback(() => {
    setEditActive((prev) => {
      const next = !prev;
      if (next) {
        setActive(false);
        send({ type: "lovable:picker:disable" });
        send({ type: "lovable:edit:enable" });
      } else {
        send({ type: "lovable:edit:disable" });
      }
      return next;
    });
  }, [send]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as any;
      if (!data || typeof data !== "object") return;

      if (data.type === "lovable:picker:selected" && data.selector) {
        const label = data.ariaLabel || data.text || data.tag;
        // When the sandbox's Vite plugin injects data-lov-id / data-source-file
        // we get an exact source location (path:line:col). That's far more
        // reliable than mapping a Tailwind class selector — minified CSS in a
        // production preview can drop those classes entirely.
        const sourceLine = data.sourceLoc
          ? `🎯 Source: \`${data.sourceLoc}\` (open this exact location and edit it)\n`
          : "";
        const reference =
          `📍 Selected element: \`${data.selector}\`` +
          (label ? ` — "${String(label).slice(0, 80)}"` : "") +
          "\n" + sourceLine +
          "\nWhat should I change about it?\n";
        window.dispatchEvent(
          new CustomEvent("agent-composer-append", { detail: { text: reference } }),
        );
        toast.success("Element selected", {
          description: data.sourceLoc ?? String(data.selector).slice(0, 64),
          duration: 2500,
        });
        setActive(false);
      }

      if (data.type === "lovable:edit:changed" && data.selector) {
        const sourceLine = data.sourceLoc
          ? `🎯 Source: \`${data.sourceLoc}\`\n`
          : "";
        const text =
          `✏️ Inline edit on \`${data.selector}\`\n` +
          sourceLine +
          `**Before:** "${String(data.before ?? "").slice(0, 200)}"\n` +
          `**After:**  "${String(data.after ?? "").slice(0, 200)}"\n\n` +
          "Update the source so this text change is persisted.\n";
        window.dispatchEvent(
          new CustomEvent("agent-composer-append", { detail: { text } }),
        );
        toast.success("Edit captured", {
          description: String(data.after ?? "").slice(0, 64),
          duration: 2500,
        });
      }

      if (data.type === "lovable:picker:ready" && activeRef.current) {
        send({ type: "lovable:picker:enable" });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [send]);

  return { active, editActive, enable, disable, toggle, toggleEdit };
}
