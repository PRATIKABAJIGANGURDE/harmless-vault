import {
  Folder as FolderIcon,
  FolderLock,
  Lock,
  MoreVertical,
  PencilLine,
  ShieldOff,
  Trash2,
  Unlock,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatBytes } from "@/lib/utils";
import type { VaultFolder } from "@/lib/vault/types";

interface FolderCardProps {
  folder: VaultFolder;
  index: number;
  onOpen: (folder: VaultFolder) => void;
  onRename: (folder: VaultFolder) => void;
  onDelete: (folder: VaultFolder) => void;
  onSetPin: (folder: VaultFolder) => void;
  onRemovePin: (folder: VaultFolder) => void;
  onLock: (folder: VaultFolder) => void;
}

export function FolderCard({
  folder,
  index,
  onOpen,
  onRename,
  onDelete,
  onSetPin,
  onRemovePin,
  onLock,
}: FolderCardProps) {
  return (
    <div
      className="animate-rise panel group relative rounded-2xl p-5 transition-all duration-300 hover:-translate-y-1 hover:border-primary/50"
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
    >
      <button
        type="button"
        onClick={() => onOpen(folder)}
        className="flex w-full items-start gap-4 text-left"
      >
        <span
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-xl transition-colors",
            folder.isLocked
              ? "bg-[color-mix(in_oklab,var(--vault-locked)_18%,transparent)] text-[--vault-locked]"
              : "bg-primary/12 text-primary group-hover:bg-primary/20",
          )}
        >
          {folder.isProtected ? <FolderLock className="size-6" /> : <FolderIcon className="size-6" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-display block truncate text-base font-semibold">{folder.name}</span>
          <span className="mt-1 block text-sm text-muted-foreground">
            {folder.isLocked ? (
              <span className="text-[--vault-locked]">Locked · PIN required</span>
            ) : (
              <>
                {folder.folderCount} folder{folder.folderCount === 1 ? "" : "s"} · {folder.fileCount}{" "}
                file{folder.fileCount === 1 ? "" : "s"}
                {folder.totalSize > 0 ? ` · ${formatBytes(folder.totalSize)}` : ""}
              </>
            )}
          </span>
        </span>
      </button>

      <div className="absolute right-3 top-3 flex items-center gap-1">
        {folder.isProtected ? (
          <span
            className={cn(
              "rounded-full p-1.5",
              folder.isLocked ? "text-[--vault-locked]" : "text-primary",
            )}
            title={folder.isLocked ? "Locked" : "Unlocked"}
          >
            {folder.isLocked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
          </span>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            className="rounded-full p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus:opacity-100 group-hover:opacity-100"
            aria-label={`Actions for ${folder.name}`}
          >
            <MoreVertical className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onRename(folder)} disabled={folder.isLocked}>
              <PencilLine className="mr-2 size-4" /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSetPin(folder)}>
              <Lock className="mr-2 size-4" /> {folder.isProtected ? "Change PIN" : "Add PIN"}
            </DropdownMenuItem>
            {folder.isProtected && !folder.isLocked ? (
              <DropdownMenuItem onClick={() => onLock(folder)}>
                <Lock className="mr-2 size-4" /> Lock now
              </DropdownMenuItem>
            ) : null}
            {folder.isProtected && !folder.isLocked ? (
              <DropdownMenuItem onClick={() => onRemovePin(folder)}>
                <ShieldOff className="mr-2 size-4" /> Remove PIN
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              onClick={() => onDelete(folder)}
              disabled={folder.isLocked}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 size-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
