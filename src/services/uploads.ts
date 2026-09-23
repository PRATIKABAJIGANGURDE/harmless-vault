// Upload engine.
//
// The file body is streamed straight from disk to the storage backend using the
// short-lived ticket the API hands out: it is never read into JavaScript memory,
// so there is no app-imposed size ceiling. Uploads run at a fixed concurrency so
// a dropped folder of 50 files does not open 50 sockets at once.

import { completeUpload, discardUpload, requestUpload } from "@/services/files";
import { VaultError } from "@/lib/vault/types";

const MAX_CONCURRENT_UPLOADS = 3;

let active = 0;
const waiting: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT_UPLOADS) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiting.push(() => {
      active += 1;
      resolve();
    });
  });
}

function release() {
  active = Math.max(0, active - 1);
  waiting.shift()?.();
}

export interface UploadHandle {
  cancel: () => void;
  done: Promise<void>;
}

export function uploadFile(options: {
  file: File;
  folderId: string | null;
  onProgress: (percent: number) => void;
}): UploadHandle {
  let xhr: XMLHttpRequest | null = null;
  let cancelled = false;
  let fileId: string | null = null;

  const done = (async () => {
    await acquire();
    try {
      if (cancelled) throw new VaultError("VALIDATION", "Upload cancelled.", 499);

      const ticket = await requestUpload({
        folderId: options.folderId,
        name: options.file.name,
        size: options.file.size,
        mimeType: options.file.type || "application/octet-stream",
      });
      fileId = ticket.fileId;
      if (cancelled) throw new VaultError("VALIDATION", "Upload cancelled.", 499);

      await new Promise<void>((resolve, reject) => {
        const request = new XMLHttpRequest();
        xhr = request;
        request.open(ticket.method, ticket.url, true);
        for (const [key, value] of Object.entries(ticket.headers)) {
          request.setRequestHeader(key, value);
        }
        request.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            options.onProgress(Math.round((event.loaded / event.total) * 100));
          }
        };
        request.onload = () =>
          request.status >= 200 && request.status < 300
            ? resolve()
            : reject(new VaultError("SERVER_ERROR", "The storage backend rejected the upload.", request.status));
        request.onerror = () =>
          reject(new VaultError("SERVER_ERROR", "The connection dropped during upload.", 0));
        request.onabort = () => reject(new VaultError("VALIDATION", "Upload cancelled.", 499));
        request.send(options.file);
      });

      await completeUpload(ticket.fileId, options.file.size);
      options.onProgress(100);
    } catch (error) {
      // Leave no half-written rows behind.
      if (fileId) void discardUpload(fileId).catch(() => undefined);
      throw error;
    } finally {
      release();
    }
  })();

  return {
    cancel: () => {
      cancelled = true;
      xhr?.abort();
    },
    done,
  };
}
