// Browser-side upload helper.
//
// The file body is streamed straight from disk to the storage backend using a
// short-lived signed URL: it is never read into JavaScript memory, so there is
// no app-imposed size ceiling. The app server only issues the ticket and
// records metadata.

import { completeUpload, createUpload } from "@/lib/vault.functions";

export interface UploadHandle {
  abort: () => void;
  done: Promise<void>;
}

export function uploadFile(options: {
  file: File;
  folderId: string | null;
  tokens: string[];
  onProgress: (percent: number) => void;
}): UploadHandle {
  let xhr: XMLHttpRequest | null = null;
  let aborted = false;

  const done = (async () => {
    const ticket = await createUpload({
      data: {
        folderId: options.folderId,
        name: options.file.name,
        size: options.file.size,
        mimeType: options.file.type || "application/octet-stream",
        tokens: options.tokens,
      },
    });
    if (aborted) throw new Error("Upload cancelled.");

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
          : reject(new Error(`Upload failed (${request.status}).`));
      request.onerror = () => reject(new Error("The connection dropped during upload."));
      request.onabort = () => reject(new Error("Upload cancelled."));
      request.send(options.file);
    });

    await completeUpload({
      data: { fileId: ticket.fileId, size: options.file.size, tokens: options.tokens },
    });
    options.onProgress(100);
  })();

  return {
    abort: () => {
      aborted = true;
      xhr?.abort();
    },
    done,
  };
}
