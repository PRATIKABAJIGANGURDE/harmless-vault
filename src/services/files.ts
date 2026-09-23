// File operations. Thin, typed wrappers over the REST contract in docs/API.md.

import { api } from "@/services/client";
import type { SortDirection, SortKey, UploadTarget, VaultFile } from "@/lib/vault/types";

/** Storage links arrive relative; point them at the configured API backend. */
export function withResolvedPreview(file: VaultFile): VaultFile {
  return { ...file, previewUrl: api.resolve(file.previewUrl) };
}

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
    .then((r) => r.files.map(withResolvedPreview));
}

export async function requestUpload(input: {
  folderId: string | null;
  name: string;
  size: number;
  mimeType: string;
}): Promise<UploadTarget> {
  const ticket = await api.post<UploadTarget>("/api/files/upload", input);
  return { ...ticket, url: api.resolve(ticket.url) ?? ticket.url };
}

export function completeUpload(fileId: string, size: number) {
  return api.post<{ file: VaultFile }>(`/api/files/${fileId}/complete`, { size });
}

export function discardUpload(fileId: string) {
  return api.delete<{ ok: true }>(`/api/files/${fileId}/complete`);
}

export async function getDownload(fileId: string) {
  const result = await api.get<{ url: string; name: string; size: number; mimeType: string }>(
    `/api/files/${fileId}/download`,
  );
  return { ...result, url: api.resolve(result.url) ?? result.url };
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
