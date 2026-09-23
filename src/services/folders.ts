// Folder operations. Thin, typed wrappers over the REST contract in docs/API.md.

import { api } from "@/services/client";
import { unlockStore } from "@/services/session";
import type {
  BreadcrumbEntry,
  FolderView,
  SortDirection,
  SortKey,
  VaultFolder,
  VaultStats,
} from "@/lib/vault/types";

const segment = (folderId: string | null) => folderId ?? "root";

export function getFolderView(
  folderId: string | null,
  options: { search?: string; sort?: SortKey; direction?: SortDirection } = {},
): Promise<FolderView> {
  return api.get<FolderView>(`/api/folders/${segment(folderId)}/files`, {
    search: options.search ?? "",
    sort: options.sort ?? "created",
    direction: options.direction ?? "desc",
  });
}

export function getStats(): Promise<VaultStats> {
  return api.get<VaultStats>("/api/stats");
}

export function listFolderTree(): Promise<BreadcrumbEntry[]> {
  return api.get<{ folders: BreadcrumbEntry[] }>("/api/folders/tree").then((r) => r.folders);
}

export function createFolder(input: {
  name: string;
  parentId: string | null;
  pin?: string | null;
}): Promise<VaultFolder> {
  return api
    .post<{ folder: VaultFolder }>("/api/folders", {
      name: input.name,
      parentId: input.parentId,
      pin: input.pin ?? null,
    })
    .then((r) => r.folder);
}

export function renameFolder(folderId: string, name: string) {
  return api.patch<{ ok: true }>(`/api/folders/${folderId}`, { name });
}

export function deleteFolder(folderId: string) {
  return api.delete<{ ok: true }>(`/api/folders/${folderId}`);
}

export function setFolderPin(folderId: string, pin: string) {
  return api.patch<{ ok: true }>(`/api/folders/${folderId}`, { pin });
}

export function removeFolderPin(folderId: string) {
  return api.patch<{ ok: true }>(`/api/folders/${folderId}`, { pin: null });
}

export async function unlockFolder(folderId: string, pin: string) {
  const result = await api.post<{ token: string | null; expiresAt: string | null }>(
    `/api/folders/${folderId}/unlock`,
    { pin },
  );
  if (result.token && result.expiresAt) unlockStore.set(folderId, result.token, result.expiresAt);
  return result;
}

export async function lockFolder(folderId: string) {
  const result = await api.post<{ ok: true }>(`/api/folders/${folderId}/lock`);
  unlockStore.clear(folderId);
  return result;
}
