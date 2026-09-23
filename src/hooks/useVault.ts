// React data hooks. They only talk to the service layer, never to a backend
// directly, so pointing the app at a different API is a configuration change.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";

import * as files from "@/services/files";
import * as folders from "@/services/folders";
import { unlockStore } from "@/services/session";
import type { SortDirection, SortKey } from "@/lib/vault/types";

/** Re-renders whenever an unlock ticket is added or cleared. */
export function useUnlockTokens(): string[] {
  const subscribe = useCallback((cb: () => void) => unlockStore.subscribe(cb), []);
  return useSyncExternalStore(
    subscribe,
    () => unlockStore.getTokens().join(","),
    () => "",
  )
    .split(",")
    .filter(Boolean);
}

export interface ViewOptions {
  search: string;
  sort: SortKey;
  direction: SortDirection;
}

export function useFolderView(folderId: string | null, options: ViewOptions) {
  const tokens = useUnlockTokens();
  return useQuery({
    queryKey: ["folder-view", folderId, tokens.join(","), options],
    queryFn: () => folders.getFolderView(folderId, options),
    retry: false,
  });
}

export function useVaultStats() {
  const tokens = useUnlockTokens();
  return useQuery({
    queryKey: ["vault-stats", tokens.join(",")],
    queryFn: () => folders.getStats(),
    retry: false,
  });
}

export function useFolderTree(enabled: boolean) {
  const tokens = useUnlockTokens();
  return useQuery({
    queryKey: ["folder-tree", tokens.join(",")],
    queryFn: () => folders.listFolderTree(),
    enabled,
    retry: false,
  });
}

export function useVaultActions() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["folder-view"] });
    queryClient.invalidateQueries({ queryKey: ["vault-stats"] });
    queryClient.invalidateQueries({ queryKey: ["folder-tree"] });
  };

  return {
    invalidate,
    createFolder: useMutation({
      mutationFn: (input: { name: string; parentId: string | null; pin?: string | null }) =>
        folders.createFolder(input),
      onSuccess: invalidate,
    }),
    renameFolder: useMutation({
      mutationFn: (input: { folderId: string; name: string }) =>
        folders.renameFolder(input.folderId, input.name),
      onSuccess: invalidate,
    }),
    deleteFolder: useMutation({
      mutationFn: (folderId: string) => folders.deleteFolder(folderId),
      onSuccess: (_d, folderId) => {
        unlockStore.clear(folderId);
        invalidate();
      },
    }),
    setPin: useMutation({
      mutationFn: (input: { folderId: string; pin: string }) =>
        folders.setFolderPin(input.folderId, input.pin),
      onSuccess: (_d, input) => {
        unlockStore.clear(input.folderId);
        invalidate();
      },
    }),
    removePin: useMutation({
      mutationFn: (folderId: string) => folders.removeFolderPin(folderId),
      onSuccess: (_d, folderId) => {
        unlockStore.clear(folderId);
        invalidate();
      },
    }),
    unlock: useMutation({
      mutationFn: (input: { folderId: string; pin: string }) =>
        folders.unlockFolder(input.folderId, input.pin),
      onSuccess: invalidate,
    }),
    lock: useMutation({
      mutationFn: (folderId: string) => folders.lockFolder(folderId),
      onSuccess: invalidate,
    }),
    renameFile: useMutation({
      mutationFn: (input: { fileId: string; name: string }) =>
        files.renameFile(input.fileId, input.name),
      onSuccess: invalidate,
    }),
    moveFile: useMutation({
      mutationFn: (input: { fileId: string; folderId: string | null }) =>
        files.moveFile(input.fileId, input.folderId),
      onSuccess: invalidate,
    }),
    deleteFile: useMutation({
      mutationFn: (fileId: string) => files.deleteFile(fileId),
      onSuccess: invalidate,
    }),
    download: useMutation({
      mutationFn: (fileId: string) => files.getDownload(fileId),
      onSuccess: (result) => files.triggerBrowserDownload(result.url, result.name),
    }),
  };
}
