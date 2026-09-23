import { useNavigate } from "@tanstack/react-router";
import {
  ChevronRight,
  FolderPlus,
  HardDrive,
  Home,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { FileRow } from "@/components/vault/FileRow";
import { FolderCard } from "@/components/vault/FolderCard";
import { PinPad } from "@/components/vault/PinPad";
import { UploadQueue, type QueueItem } from "@/components/vault/UploadQueue";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useFolderView, useUnlockTokens, useVaultActions, useVaultStats } from "@/hooks/useVault";
import { cn, formatBytes } from "@/lib/utils";
import { uploadFile } from "@/lib/vault/upload";
import type { VaultFile, VaultFolder } from "@/lib/vault/types";
import { isLockedError } from "@/lib/vault/types";

type PinMode = { kind: "unlock" | "set"; folder: VaultFolder | null; folderId: string } | null;

export function VaultBrowser({ folderId }: { folderId: string | null }) {
  const navigate = useNavigate();
  const tokens = useUnlockTokens();
  const view = useFolderView(folderId);
  const stats = useVaultStats();
  const actions = useVaultActions();

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pinMode, setPinMode] = useState<PinMode>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderProtected, setNewFolderProtected] = useState(false);
  const [newFolderPin, setNewFolderPin] = useState("");
  const [renaming, setRenaming] = useState<
    { kind: "folder" | "file"; id: string; name: string } | null
  >(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const locked = view.isError && isLockedError(view.error);

  const startUploads = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const id = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
        const handle = uploadFile({
          file,
          folderId,
          tokens,
          onProgress: (progress) =>
            setQueue((q) => q.map((i) => (i.id === id ? { ...i, progress } : i))),
        });
        setQueue((q) => [
          ...q,
          {
            id,
            name: file.name,
            size: file.size,
            progress: 0,
            status: "uploading",
            abort: handle.abort,
          },
        ]);
        handle.done
          .then(() => {
            setQueue((q) =>
              q.map((i) => (i.id === id ? { ...i, status: "done", progress: 100 } : i)),
            );
            view.refetch();
            stats.refetch();
          })
          .catch((error: Error) => {
            const message = isLockedError(error)
              ? "This folder is locked. Unlock it to upload."
              : error.message;
            setQueue((q) =>
              q.map((i) => (i.id === id ? { ...i, status: "error", error: message } : i)),
            );
            toast.error(message);
          });
      }
    },
    [folderId, tokens, view, stats],
  );

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length) startUploads(files);
  };

  const data = view.data;
  const isEmpty = !!data && data.folders.length === 0 && data.files.length === 0;

  const breadcrumbs = useMemo(() => data?.breadcrumbs ?? [], [data]);

  /* --------------------------------- PIN flows -------------------------------- */

  const submitPin = (pin: string) => {
    if (!pinMode) return;
    setPinError(null);
    if (pinMode.kind === "unlock") {
      actions.unlock.mutate(
        { folderId: pinMode.folderId, pin },
        {
          onSuccess: () => {
            setPinMode(null);
            toast.success("Folder unlocked");
          },
          onError: (error: Error) => setPinError(error.message),
        },
      );
    } else {
      actions.setPin.mutate(
        { folderId: pinMode.folderId, pin },
        {
          onSuccess: () => {
            setPinMode(null);
            toast.success("PIN saved. The folder is now locked.");
          },
          onError: (error: Error) => setPinError(error.message),
        },
      );
    }
  };

  const openFolder = (folder: VaultFolder) => {
    if (folder.isLocked) {
      setPinError(null);
      setPinMode({ kind: "unlock", folder, folderId: folder.id });
      return;
    }
    navigate({ to: "/f/$folderId", params: { folderId: folder.id } });
  };

  const submitRename = () => {
    if (!renaming) return;
    const payload = { name: renaming.name };
    const done = () => {
      setRenaming(null);
      toast.success("Renamed");
    };
    if (renaming.kind === "folder") {
      actions.renameFolder.mutate(
        { folderId: renaming.id, ...payload },
        { onSuccess: done, onError: (e: Error) => toast.error(e.message) },
      );
    } else {
      actions.renameFile.mutate(
        { fileId: renaming.id, ...payload },
        { onSuccess: done, onError: (e: Error) => toast.error(e.message) },
      );
    }
  };

  const submitNewFolder = () => {
    if (newFolderProtected && !/^\d{4}$/.test(newFolderPin)) {
      toast.error("The PIN must be exactly 4 digits.");
      return;
    }
    actions.createFolder.mutate(
      {
        name: newFolderName,
        parentId: folderId,
        pin: newFolderProtected ? newFolderPin : null,
      },
      {
        onSuccess: () => {
          setNewFolderOpen(false);
          setNewFolderName("");
          setNewFolderPin("");
          setNewFolderProtected(false);
          toast.success("Folder created");
        },
        onError: (e: Error) => toast.error(e.message),
      },
    );
  };

  /* ---------------------------------- render ---------------------------------- */

  return (
    <div className="vault-backdrop min-h-screen">
      <div className="mx-auto w-full max-w-6xl px-5 pb-28 pt-10">
        <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3">
              <span className="glow-ring flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <ShieldCheck className="size-6" />
              </span>
              <div>
                <h1 className="text-display text-2xl font-bold">Harmless Vault</h1>
                <p className="text-sm text-muted-foreground">
                  Private storage with PIN-protected folders
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-6 text-sm">
            {stats.isPending ? (
              <Skeleton className="h-10 w-40" />
            ) : stats.data ? (
              <>
                <div>
                  <p className="text-display text-lg font-semibold">{stats.data.fileCount}</p>
                  <p className="text-xs text-muted-foreground">files</p>
                </div>
                <div>
                  <p className="text-display text-lg font-semibold">{stats.data.folderCount}</p>
                  <p className="text-xs text-muted-foreground">folders</p>
                </div>
                <div>
                  <p className="text-display flex items-center gap-1.5 text-lg font-semibold">
                    <HardDrive className="size-4 text-primary" />
                    {formatBytes(stats.data.totalSize)}
                  </p>
                  <p className="text-xs text-muted-foreground">stored</p>
                </div>
              </>
            ) : null}
          </div>
        </header>

        <nav className="mb-6 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          <button
            type="button"
            onClick={() => navigate({ to: "/" })}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Home className="size-3.5" /> Vault
          </button>
          {breadcrumbs.map((crumb, index) => (
            <span key={crumb.id} className="flex items-center gap-1">
              <ChevronRight className="size-3.5" />
              <button
                type="button"
                onClick={() => navigate({ to: "/f/$folderId", params: { folderId: crumb.id } })}
                className={cn(
                  "rounded-md px-2 py-1 transition-colors hover:bg-secondary hover:text-foreground",
                  index === breadcrumbs.length - 1 && "text-foreground",
                )}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>

        {locked ? (
          <LockedPanel
            onUnlock={() =>
              folderId && setPinMode({ kind: "unlock", folder: null, folderId: folderId })
            }
          />
        ) : view.isError ? (
          <ErrorPanel message={(view.error as Error).message} onRetry={() => view.refetch()} />
        ) : (
          <>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                "panel mb-8 rounded-2xl border-dashed p-10 text-center transition-all duration-300",
                dragging && "animate-pulse-ring scale-[1.01] border-primary bg-primary/5",
              )}
            >
              <span
                className={cn(
                  "mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/12 text-primary transition-transform duration-300",
                  dragging && "-translate-y-1 scale-110",
                )}
              >
                <UploadCloud className="size-7" />
              </span>
              <p className="text-display text-lg font-semibold">
                {dragging ? "Release to upload" : "Drop files here"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Files stream straight to storage — large files are fine.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                <Button onClick={() => inputRef.current?.click()}>
                  <UploadCloud className="mr-2 size-4" /> Choose files
                </Button>
                <Button variant="secondary" onClick={() => setNewFolderOpen(true)}>
                  <FolderPlus className="mr-2 size-4" /> New folder
                </Button>
              </div>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) startUploads(files);
                  e.target.value = "";
                }}
              />
            </div>

            {view.isPending ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-2xl" />
                ))}
              </div>
            ) : isEmpty ? (
              <EmptyPanel onCreate={() => setNewFolderOpen(true)} />
            ) : (
              <div className="space-y-10">
                {data!.folders.length > 0 ? (
                  <section>
                    <h2 className="text-display mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      Folders
                    </h2>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {data!.folders.map((folder, index) => (
                        <FolderCard
                          key={folder.id}
                          folder={folder}
                          index={index}
                          onOpen={openFolder}
                          onRename={(f) =>
                            setRenaming({ kind: "folder", id: f.id, name: f.name })
                          }
                          onDelete={(f) =>
                            actions.deleteFolder.mutate(f.id, {
                              onSuccess: () => toast.success("Folder deleted"),
                              onError: (e: Error) => toast.error(e.message),
                            })
                          }
                          onSetPin={(f) => {
                            setPinError(null);
                            setPinMode({ kind: "set", folder: f, folderId: f.id });
                          }}
                          onRemovePin={(f) =>
                            actions.removePin.mutate(f.id, {
                              onSuccess: () => toast.success("PIN removed"),
                              onError: (e: Error) => toast.error(e.message),
                            })
                          }
                          onLock={(f) =>
                            actions.lock.mutate(f.id, {
                              onSuccess: () => toast.success("Folder locked"),
                              onError: (e: Error) => toast.error(e.message),
                            })
                          }
                        />
                      ))}
                    </div>
                  </section>
                ) : null}

                {data!.files.length > 0 ? (
                  <section>
                    <h2 className="text-display mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      Files
                    </h2>
                    <div className="space-y-2">
                      {data!.files.map((file: VaultFile, index: number) => (
                        <FileRow
                          key={file.id}
                          file={file}
                          index={index}
                          busy={actions.download.isPending}
                          onDownload={(f) =>
                            actions.download.mutate(f.id, {
                              onError: (e: Error) => toast.error(e.message),
                            })
                          }
                          onRename={(f) => setRenaming({ kind: "file", id: f.id, name: f.name })}
                          onDelete={(f) =>
                            actions.deleteFile.mutate(f.id, {
                              onSuccess: () => toast.success("File deleted"),
                              onError: (e: Error) => toast.error(e.message),
                            })
                          }
                        />
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>

      <UploadQueue
        items={queue}
        onDismiss={(id) => setQueue((q) => q.filter((i) => i.id !== id))}
        onClear={() => setQueue([])}
      />

      <PinPad
        open={pinMode !== null}
        title={pinMode?.kind === "set" ? "Set a 4-digit PIN" : "Enter folder PIN"}
        description={
          pinMode?.kind === "set"
            ? "This folder will lock immediately after the PIN is saved."
            : "This folder is locked. Its contents stay hidden until the PIN is correct."
        }
        confirmLabel={pinMode?.kind === "set" ? "Save PIN" : "Unlock"}
        pending={actions.unlock.isPending || actions.setPin.isPending}
        error={pinError}
        onSubmit={submitPin}
        onOpenChange={(open) => {
          if (!open) {
            setPinMode(null);
            setPinError(null);
          }
        }}
      />

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="panel max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-display">New folder</DialogTitle>
            <DialogDescription>Folders can be nested and PIN-protected.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="folder-name">Name</Label>
              <Input
                id="folder-name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Private"
                autoFocus
              />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border/70 px-4 py-3">
              <div className="flex items-center gap-2 text-sm">
                <Lock className="size-4 text-primary" /> Protect with a PIN
              </div>
              <Switch checked={newFolderProtected} onCheckedChange={setNewFolderProtected} />
            </div>
            {newFolderProtected ? (
              <div className="space-y-2">
                <Label htmlFor="folder-pin">4-digit PIN</Label>
                <Input
                  id="folder-pin"
                  inputMode="numeric"
                  maxLength={4}
                  value={newFolderPin}
                  onChange={(e) => setNewFolderPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="••••"
                  className="tracking-[0.5em]"
                />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              className="w-full"
              disabled={!newFolderName.trim() || actions.createFolder.isPending}
              onClick={submitNewFolder}
            >
              {actions.createFolder.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              Create folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="panel max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-display">Rename</DialogTitle>
            <DialogDescription>Choose a new name.</DialogDescription>
          </DialogHeader>
          <Input
            value={renaming?.name ?? ""}
            onChange={(e) => setRenaming((r) => (r ? { ...r, name: e.target.value } : r))}
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && submitRename()}
          />
          <DialogFooter>
            <Button className="w-full" onClick={submitRename} disabled={!renaming?.name.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LockedPanel({ onUnlock }: { onUnlock: () => void }) {
  return (
    <div className="panel animate-rise rounded-2xl p-14 text-center">
      <span className="animate-pulse-ring mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--vault-locked)_18%,transparent)] text-[--vault-locked]">
        <Lock className="size-8" />
      </span>
      <h2 className="text-display text-xl font-semibold">This folder is locked</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        Its files, uploads and downloads are blocked until you enter the correct 4-digit PIN.
      </p>
      <Button className="mt-6" onClick={onUnlock}>
        <Lock className="mr-2 size-4" /> Enter PIN
      </Button>
    </div>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="panel animate-rise rounded-2xl p-14 text-center">
      <h2 className="text-display text-xl font-semibold">Something went wrong</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{message}</p>
      <Button variant="secondary" className="mt-6" onClick={onRetry}>
        <RefreshCw className="mr-2 size-4" /> Try again
      </Button>
    </div>
  );
}

function EmptyPanel({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="panel animate-rise rounded-2xl p-14 text-center">
      <span className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-secondary/60 text-muted-foreground">
        <FolderPlus className="size-8" />
      </span>
      <h2 className="text-display text-xl font-semibold">Nothing here yet</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        Drop files above, or create a folder to organise them.
      </p>
      <Button variant="secondary" className="mt-6" onClick={onCreate}>
        <FolderPlus className="mr-2 size-4" /> New folder
      </Button>
    </div>
  );
}
