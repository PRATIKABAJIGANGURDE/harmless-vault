import {
  Download,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileType2,
  FileVideo,
  FolderInput,
  MoreVertical,
  PencilLine,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatBytes } from "@/lib/utils";
import type { FileKind, VaultFile } from "@/lib/vault/types";

const ICONS: Record<FileKind, typeof FileText> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  pdf: FileType2,
  archive: FileArchive,
  document: FileText,
  other: FileText,
};

interface FileRowProps {
  file: VaultFile;
  index: number;
  busy?: boolean;
  onDownload: (file: VaultFile) => void;
  onRename: (file: VaultFile) => void;
  onMove: (file: VaultFile) => void;
  onDelete: (file: VaultFile) => void;
}

export function FileRow({
  file,
  index,
  busy,
  onDownload,
  onRename,
  onMove,
  onDelete,
}: FileRowProps) {
  const Icon = ICONS[file.kind] ?? FileText;
  const [thumbFailed, setThumbFailed] = useState(false);
  const showThumb = file.kind === "image" && file.previewUrl && !thumbFailed;

  return (
    <div
      className="animate-rise group flex items-center gap-4 rounded-xl border border-border/60 bg-surface/50 px-4 py-3 transition-colors hover:border-primary/40 hover:bg-surface"
      style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}
    >
      {showThumb ? (
        <img
          src={file.previewUrl ?? ""}
          alt=""
          loading="lazy"
          onError={() => setThumbFailed(true)}
          className="size-10 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary/60 text-muted-foreground group-hover:text-primary">
          <Icon className="size-5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.name}</p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(file.size)} · {new Date(file.updatedAt).toLocaleString()}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onDownload(file)}
        disabled={busy}
        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-primary disabled:opacity-50"
        aria-label={`Download ${file.name}`}
      >
        <Download className="size-4" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label={`Actions for ${file.name}`}
        >
          <MoreVertical className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onRename(file)}>
            <PencilLine className="mr-2 size-4" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onMove(file)}>
            <FolderInput className="mr-2 size-4" /> Move to…
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onDelete(file)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 size-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
