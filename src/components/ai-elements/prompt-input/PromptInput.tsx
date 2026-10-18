"use client";

import { InputGroup } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import type { FileUIPart, SourceDocumentUIPart } from "ai";
import { nanoid } from "nanoid";
import {
  type ChangeEventHandler,
  type FormEvent,
  type FormEventHandler,
  type HTMLAttributes,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type AttachmentsContext,
  LocalAttachmentsContext,
  LocalReferencedSourcesContext,
  type ReferencedSourcesContext,
  useOptionalPromptInputController,
} from "./context";
import { convertBlobUrlToDataUrl } from "./helpers";
import { useDropZone } from "./useDropZone";
import { useLocalAttachments } from "./useLocalAttachments";

export interface PromptInputMessage {
  text: string;
  files: FileUIPart[];
}

export type PromptInputProps = Omit<
  HTMLAttributes<HTMLFormElement>,
  "onSubmit" | "onError"
> & {
  accept?: string;
  multiple?: boolean;
  /** When true, accepts drops anywhere on document. Default false (opt-in). */
  globalDrop?: boolean;
  /** Render a hidden input that stays in sync. Default false. */
  syncHiddenInput?: boolean;
  maxFiles?: number;
  /** bytes */
  maxFileSize?: number;
  onError?: (err: {
    code: "max_files" | "max_file_size" | "accept";
    message: string;
  }) => void;
  onSubmit: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>
  ) => void | Promise<void>;
};

export const PromptInput = ({
  className,
  accept,
  multiple,
  globalDrop,
  syncHiddenInput,
  maxFiles,
  maxFileSize,
  onError,
  onSubmit,
  children,
  ...props
}: PromptInputProps) => {
  const controller = useOptionalPromptInputController();
  const usingProvider = !!controller;
  const formRef = useRef<HTMLFormElement | null>(null);

  const local = useLocalAttachments({ accept, maxFiles, maxFileSize, onError });
  const files = usingProvider ? controller.attachments.files : local.items;

  const [referencedSources, setReferencedSources] = useState<
    (SourceDocumentUIPart & { id: string })[]
  >([]);
  const clearReferencedSources = useCallback(
    () => setReferencedSources([]),
    []
  );

  // When provider is mounted, route add() through provider but still validate locally
  const addWithProviderValidation = useCallback(
    (fileList: File[] | FileList) => {
      const sized = local.validate([...fileList]);
      if (!sized) return;
      const currentCount = files.length;
      const capacity =
        typeof maxFiles === "number"
          ? Math.max(0, maxFiles - currentCount)
          : undefined;
      const capped =
        typeof capacity === "number" ? sized.slice(0, capacity) : sized;
      if (typeof capacity === "number" && sized.length > capacity) {
        onError?.({
          code: "max_files",
          message: "Too many files. Some were not added.",
        });
      }
      if (capped.length > 0) controller?.attachments.add(capped);
    },
    [local, files.length, maxFiles, onError, controller]
  );

  const add = usingProvider ? addWithProviderValidation : local.add;
  const remove = usingProvider ? controller.attachments.remove : local.remove;
  const openFileDialog = usingProvider
    ? controller.attachments.openFileDialog
    : local.openFileDialog;
  const clearAttachments = usingProvider
    ? () => controller?.attachments.clear()
    : local.clear;

  const clear = useCallback(() => {
    clearAttachments();
    clearReferencedSources();
  }, [clearAttachments, clearReferencedSources]);

  // Register file input with provider
  useEffect(() => {
    if (!usingProvider) return;
    controller.__registerFileInput(local.inputRef, () =>
      local.inputRef.current?.click()
    );
  }, [usingProvider, controller, local.inputRef]);

  // syncHiddenInput sentinel reset
  useEffect(() => {
    if (syncHiddenInput && local.inputRef.current && files.length === 0) {
      local.inputRef.current.value = "";
    }
  }, [files, syncHiddenInput, local.inputRef]);

  useDropZone(formRef, globalDrop, add as (files: FileList) => void);

  const handleChange: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => {
      if (event.currentTarget.files) add(event.currentTarget.files);
      event.currentTarget.value = "";
    },
    [add]
  );

  const attachmentsCtx = useMemo<AttachmentsContext>(
    () => ({
      add,
      clear: clearAttachments,
      fileInputRef: local.inputRef,
      files: files.map((item) => ({ ...item, id: item.id })),
      openFileDialog,
      remove,
    }),
    [files, add, remove, clearAttachments, openFileDialog, local.inputRef]
  );

  const refsCtx = useMemo<ReferencedSourcesContext>(
    () => ({
      add: (incoming: SourceDocumentUIPart[] | SourceDocumentUIPart) => {
        const array = Array.isArray(incoming) ? incoming : [incoming];
        setReferencedSources((prev) => [
          ...prev,
          ...array.map((s) => ({ ...s, id: nanoid() })),
        ]);
      },
      clear: clearReferencedSources,
      remove: (id: string) => {
        setReferencedSources((prev) => prev.filter((s) => s.id !== id));
      },
      sources: referencedSources,
    }),
    [referencedSources, clearReferencedSources]
  );

  const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const text = usingProvider
        ? controller.textInput.value
        : (() => {
            const formData = new FormData(form);
            return (formData.get("message") as string) || "";
          })();

      if (!usingProvider) form.reset();

      try {
        const convertedFiles: FileUIPart[] = await Promise.all(
          files.map(async ({ id: _id, ...item }) => {
            if (item.url?.startsWith("blob:")) {
              const dataUrl = await convertBlobUrlToDataUrl(item.url);
              return { ...item, url: dataUrl ?? item.url };
            }
            return item;
          })
        );

        const result = onSubmit({ files: convertedFiles, text }, event);

        if (result instanceof Promise) {
          try {
            await result;
            clear();
            if (usingProvider) controller.textInput.clear();
          } catch {
            /* keep input on error */
          }
        } else {
          clear();
          if (usingProvider) controller.textInput.clear();
        }
      } catch {
        /* keep input on error */
      }
    },
    [usingProvider, controller, files, onSubmit, clear]
  );

  const inner = (
    <>
      <input
        accept={accept}
        aria-label="Upload files"
        className="hidden"
        multiple={multiple}
        onChange={handleChange}
        ref={local.inputRef}
        title="Upload files"
        type="file"
      />
      <form
        className={cn("w-full", className)}
        onSubmit={handleSubmit}
        ref={formRef}
        {...props}
      >
        <InputGroup className="overflow-hidden">{children}</InputGroup>
      </form>
    </>
  );

  return (
    <LocalAttachmentsContext.Provider value={attachmentsCtx}>
      <LocalReferencedSourcesContext.Provider value={refsCtx}>
        {inner}
      </LocalReferencedSourcesContext.Provider>
    </LocalAttachmentsContext.Provider>
  );
};
