import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";

import {
  createFolder,
  deleteFile,
  deleteFolder,
  fetchFolderView,
  fetchVaultStats,
  getDownloadUrl,
  lockFolder,
  removeFolderPin,
  renameFile,
  renameFolder,
  setFolderPin,
  unlockFolder,
} from "@/lib/vault.functions";
import { unlockStore } from "@/lib/vault/session";

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

export function useFolderView(folderId: string | null) {
  const tokens = useUnlockTokens();
  return useQuery({
    queryKey: ["folder-view", folderId, tokens.join(",")],
    queryFn: () => fetchFolderView({ data: { folderId, tokens } }),
    retry: false,
  });
}

export function useVaultStats() {
  const tokens = useUnlockTokens();
  return useQuery({
    queryKey: ["vault-stats", tokens.join(",")],
    queryFn: () => fetchVaultStats({ data: { tokens } }),
    retry: false,
  });
}

export function useVaultActions() {
  const queryClient = useQueryClient();
  const tokens = useUnlockTokens();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["folder-view"] });
    queryClient.invalidateQueries({ queryKey: ["vault-stats"] });
  };

  return {
    createFolder: useMutation({
      mutationFn: (input: { name: string; parentId: string | null; pin?: string | null }) =>
        createFolder({ data: { ...input, tokens } }),
      onSuccess: invalidate,
    }),
    renameFolder: useMutation({
      mutationFn: (input: { folderId: string; name: string }) =>
        renameFolder({ data: { ...input, tokens } }),
      onSuccess: invalidate,
    }),
    deleteFolder: useMutation({
      mutationFn: (folderId: string) => deleteFolder({ data: { folderId, tokens } }),
      onSuccess: (_d, folderId) => {
        unlockStore.clear(folderId);
        invalidate();
      },
    }),
    setPin: useMutation({
      mutationFn: (input: { folderId: string; pin: string }) =>
        setFolderPin({ data: { ...input, tokens } }),
      onSuccess: (_d, input) => {
        unlockStore.clear(input.folderId);
        invalidate();
      },
    }),
    removePin: useMutation({
      mutationFn: (folderId: string) => removeFolderPin({ data: { folderId, tokens } }),
      onSuccess: (_d, folderId) => {
        unlockStore.clear(folderId);
        invalidate();
      },
    }),
    unlock: useMutation({
      mutationFn: (input: { folderId: string; pin: string }) => unlockFolder({ data: input }),
      onSuccess: (result, input) => {
        if (result.token && result.expiresAt) {
          unlockStore.set(input.folderId, result.token, result.expiresAt);
        }
        invalidate();
      },
    }),
    lock: useMutation({
      mutationFn: (folderId: string) => lockFolder({ data: { folderId } }),
      onSuccess: (_d, folderId) => {
        unlockStore.clear(folderId);
        invalidate();
      },
    }),
    renameFile: useMutation({
      mutationFn: (input: { fileId: string; name: string }) =>
        renameFile({ data: { ...input, tokens } }),
      onSuccess: invalidate,
    }),
    deleteFile: useMutation({
      mutationFn: (fileId: string) => deleteFile({ data: { fileId, tokens } }),
      onSuccess: invalidate,
    }),
    download: useMutation({
      mutationFn: (fileId: string) => getDownloadUrl({ data: { fileId, tokens } }),
      onSuccess: (result) => {
        // Streams from storage to disk; the file never enters page memory.
        const link = document.createElement("a");
        link.href = result.url;
        link.download = result.name;
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
      },
    }),
  };
}
