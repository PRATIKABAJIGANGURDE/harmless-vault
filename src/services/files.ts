// File operations. Thin, typed wrappers over the REST contract in docs/API.md.

import { api } from "@/services/client";
import type { SortDirection, SortKey, UploadTarget, VaultFile } from "@/lib/vault/types";

export function searchFiles(
  query: string,
  options: { sort?: SortKey; direction?: SortDirection } = {},
): Promise<VaultFile[]> {
  return api
    .get<{ files: VaultFile[] }>("/api/files/search", {
      q: query,
      sort: options.sort ?? "created",
      direction: options.direction ?? "desc",
    })
    .then((r) => r.files);
}

export function requestUpload(input: {
  folderId: string | null;
  name: string;
  size: number;
  mimeType: string;
}): Promise<UploadTarget> {
  return api.post<UploadTarget>("/api/files/upload", input);
}

export function completeUpload(fileId: string, size: number) {
  return api.post<{ file: VaultFile }>(`/api/files/${fileId}/complete`, { size });
}

export function discardUpload(fileId: string) {
  return api.delete<{ ok: true }>(`/api/files/${fileId}/complete`);
}

export function getDownload(fileId: string) {
  return api.get<{ url: string; name: string; size: number; mimeType: string }>(
    `/api/files/${fileId}/download`,
  );
}

export function renameFile(fileId: string, name: string) {
  return api.patch<{ ok: true; name: string }>(`/api/files/${fileId}`, { name });
}

export function moveFile(fileId: string, folderId: string | null) {
  return api.post<{ ok: true }>(`/api/files/${fileId}/move`, { folderId });
}

export function deleteFile(fileId: string) {
  return api.delete<{ ok: true }>(`/api/files/${fileId}`);
}

/** Streams the file from storage to disk without buffering it in the page. */
export function triggerBrowserDownload(url: string, name: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
