"use client";

import type { FileUIPart } from "ai";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";

export interface UseLocalAttachmentsArgs {
  accept?: string;
  maxFiles?: number;
  maxFileSize?: number;
  onError?: (err: {
    code: "max_files" | "max_file_size" | "accept";
    message: string;
  }) => void;
}

/** Internal attachment-state hook used by PromptInput when no provider is mounted. */
export function useLocalAttachments({
  accept,
  maxFiles,
  maxFileSize,
  onError,
}: UseLocalAttachmentsArgs) {
  const [items, setItems] = useState<(FileUIPart & { id: string })[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const matchesAccept = useCallback(
    (f: File) => {
      if (!accept || accept.trim() === "") return true;
      const patterns = accept
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return patterns.some((pattern) => {
        if (pattern.endsWith("/*")) {
          const prefix = pattern.slice(0, -1);
          return f.type.startsWith(prefix);
        }
        return f.type === pattern;
      });
    },
    [accept]
  );

  const validate = useCallback(
    (incoming: File[]): File[] | null => {
      const accepted = incoming.filter((f) => matchesAccept(f));
      if (incoming.length && accepted.length === 0) {
        onError?.({
          code: "accept",
          message: "No files match the accepted types.",
        });
        return null;
      }
      const withinSize = (f: File) =>
        maxFileSize ? f.size <= maxFileSize : true;
      const sized = accepted.filter(withinSize);
      if (accepted.length > 0 && sized.length === 0) {
        onError?.({
          code: "max_file_size",
          message: "All files exceed the maximum size.",
        });
        return null;
      }
      return sized;
    },
    [matchesAccept, maxFileSize, onError]
  );

  const add = useCallback(
    (fileList: File[] | FileList) => {
      const sized = validate([...fileList]);
      if (!sized) return;
      setItems((prev) => {
        const capacity =
          typeof maxFiles === "number"
            ? Math.max(0, maxFiles - prev.length)
            : undefined;
        const capped =
          typeof capacity === "number" ? sized.slice(0, capacity) : sized;
        if (typeof capacity === "number" && sized.length > capacity) {
          onError?.({
            code: "max_files",
            message: "Too many files. Some were not added.",
          });
        }
        const next: (FileUIPart & { id: string })[] = [];
        for (const file of capped) {
          next.push({
            filename: file.name,
            id: nanoid(),
            mediaType: file.type,
            type: "file",
            url: URL.createObjectURL(file),
          });
        }
        return [...prev, ...next];
      });
    },
    [validate, maxFiles, onError]
  );

  const remove = useCallback(
    (id: string) =>
      setItems((prev) => {
        const found = prev.find((file) => file.id === id);
        if (found?.url) URL.revokeObjectURL(found.url);
        return prev.filter((file) => file.id !== id);
      }),
    []
  );

  const clear = useCallback(
    () =>
      setItems((prev) => {
        for (const file of prev) {
          if (file.url) URL.revokeObjectURL(file.url);
        }
        return [];
      }),
    []
  );

  const openFileDialog = useCallback(() => {
    inputRef.current?.click();
  }, []);

  // Cleanup on unmount
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(
    () => () => {
      for (const f of itemsRef.current) {
        if (f.url) URL.revokeObjectURL(f.url);
      }
    },
    []
  );

  return { items, add, remove, clear, openFileDialog, inputRef, validate };
}
