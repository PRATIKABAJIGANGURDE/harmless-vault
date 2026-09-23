// Upload queue state: start, cancel, retry, dismiss. The actual transfer lives
// in services/uploads.ts, which streams the body straight to the storage
// backend at a fixed concurrency.

import { useCallback, useRef, useState } from "react";

import type { QueueItem } from "@/components/vault/UploadQueue";
import { uploadFile, type UploadHandle } from "@/services/uploads";
import { isLockedError } from "@/lib/vault/types";

export function useUploads(folderId: string | null, onFinished: () => void) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const handles = useRef(new Map<string, UploadHandle>());
  const sources = useRef(new Map<string, File>());

  const run = useCallback(
    (id: string, file: File) => {
      const handle = uploadFile({
        file,
        folderId,
        onProgress: (progress) =>
          setQueue((q) => q.map((i) => (i.id === id ? { ...i, progress } : i))),
      });
      handles.current.set(id, handle);
      handle.done
        .then(() => {
          setQueue((q) => q.map((i) => (i.id === id ? { ...i, status: "done", progress: 100 } : i)));
          onFinished();
        })
        .catch((error: Error) => {
          const message = isLockedError(error)
            ? "This folder is locked. Unlock it to upload."
            : error.message;
          setQueue((q) =>
            q.map((i) => (i.id === id ? { ...i, status: "error", error: message } : i)),
          );
        })
        .finally(() => handles.current.delete(id));
    },
    [folderId, onFinished],
  );

  const start = useCallback(
    (incoming: File[]) => {
      for (const file of incoming) {
        const id = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
        sources.current.set(id, file);
        setQueue((q) => [
          ...q,
          { id, name: file.name, size: file.size, progress: 0, status: "uploading" },
        ]);
        run(id, file);
      }
    },
    [run],
  );

  const cancel = useCallback((id: string) => {
    handles.current.get(id)?.cancel();
    setQueue((q) => q.map((i) => (i.id === id ? { ...i, status: "error", error: "Cancelled" } : i)));
  }, []);

  const retry = useCallback(
    (id: string) => {
      const file = sources.current.get(id);
      if (!file) return;
      setQueue((q) =>
        q.map((i) => (i.id === id ? { ...i, status: "uploading", progress: 0, error: "" } : i)),
      );
      run(id, file);
    },
    [run],
  );

  const dismiss = useCallback(
    (id: string) => {
      handles.current.get(id)?.cancel();
      sources.current.delete(id);
      setQueue((q) => q.filter((i) => i.id !== id));
    },
    [],
  );

  const clear = useCallback(() => {
    setQueue((q) => q.filter((i) => i.status === "uploading"));
  }, []);

  return { queue, start, cancel, retry, dismiss, clear };
}
